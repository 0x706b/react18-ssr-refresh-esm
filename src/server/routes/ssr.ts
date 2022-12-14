import type { RouteManifestEntry } from "../manifest.js";
import type { NextFunction, Request, Response } from "express";

import path from "node:path";
import { Writable } from "node:stream";
import url from "node:url";
import React from "react";
import { renderToPipeableStream } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server.js";
import { ServerStyleSheet } from "styled-components";

import { App } from "../../App.js";
import { getRouteMatcher } from "../manifest.js";

export const htmlStart = (manifest: ReadonlyArray<RouteManifestEntry>, styleTags: string) => `
<!DOCTYPE html>
<html>
  <head>
    <title>fncts-react-template</title>
    <meta charset="UTF-8" />
    <script type="module" src="/main.js" async></script>
    ${manifest
      .map((m) => `<link rel="modulepreload" href="${m.href}" />`)
      .reverse()
      .join("")}
    ${styleTags}
  </head>

  <body>
    <div id="app">`;

export const htmlEnd = (styleTags: string) => `</div>
  </body>
  ${styleTags}
</html>
`;

const dirname = path.dirname(url.fileURLToPath(import.meta.url));

export async function ssr(req: Request, res: Response, next: NextFunction): Promise<void> {
  const match         = await getRouteMatcher(path.resolve(dirname, "../../../dist/route-manifest.json"));
  const routeManifest = match(req.url);
  if (!routeManifest) {
    next();
    return;
  }
  let errored = false;

  const sheet = new ServerStyleSheet();

  const root = sheet.collectStyles(
    React.createElement(StaticRouter, {
      location: req.url,
      children: React.createElement(App, {
        url: req.url,
        manifest: routeManifest,
      }),
    }),
  );

  const passthrough = new StyleSheetPassthrough(sheet, res);

  const { pipe } = renderToPipeableStream(root, {
    onError: (err) => {
      errored = true;
      console.error(err);
    },
    onShellReady: () => {
      const initialStyles = sheet.getStyleTags();
      sheet.instance.clearTag();
      const start    = htmlStart(routeManifest, initialStyles);
      res.statusCode = errored ? 500 : 200;
      res.setHeader("content-type", "text/html");
      res.write(start);
      pipe(passthrough);
    },
  });

  res.on("end", () => {
    sheet.seal();
  });
}

export class StyleSheetPassthrough extends Writable {
  private styles = "";

  constructor(private sheet: ServerStyleSheet, private _writable: Writable) {
    super();
  }

  writeChunk(chunk: any, encoding: BufferEncoding, cb: (err?: Error | null) => void): void {
    if (!this._writable.write(chunk, encoding)) {
      this._writable.once("drain", cb);
    } else {
      cb();
    }
  }

  _write(chunk: any, encoding: BufferEncoding, cb: (err?: Error | null) => void): void {
    // Get the style tags from the `ServerStyleSheet` since the last write
    this.styles += this.sheet.getStyleTags();
    // Clear the style tags we just got from the `ServerStyleSheet` instance
    this.sheet.instance.clearTag();
    // Write the chunk from React
    this.writeChunk(chunk, encoding, cb);
  }

  _final(): void {
    this._writable.write(htmlEnd(this.styles), "utf-8");
    this._writable.end();
  }
}

async function importFresh<Path extends string>(modulePath: Path): Promise<any> {
  return import(`${modulePath}?update=${Date.now()}`);
}
