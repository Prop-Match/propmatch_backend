import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Browser, Page } from 'puppeteer';

/**
 * Renders HTML to a PDF buffer synchronously (no job queue — see the
 * per-request latency tradeoff noted where this is called). One headless
 * Chromium instance is launched per call and closed immediately after;
 * this module has no long-lived browser to keep warm.
 *
 * puppeteer 25.x ships ESM-only, but this project's compiled output is
 * CommonJS — a static `import` here would fail at actual runtime, not just
 * in tests, so it's loaded via a dynamic import instead.
 */
@Injectable()
export class PdfRendererService {
  async renderHtmlToPdf(
    html: string,
    footerTemplate?: string,
  ): Promise<Buffer> {
    const { default: puppeteer } = await import('puppeteer');
    let browser: Browser | undefined;
    let page: Page | undefined;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      page = await browser.newPage();
      page.setDefaultTimeout(15_000);
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (request) => void request.abort());
      await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 15_000 });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        // A branded footer needs Puppeteer's own repeat-per-page mechanism —
        // an in-content CSS footer only renders once, on the last page.
        ...(footerTemplate
          ? {
              displayHeaderFooter: true,
              headerTemplate: '<span></span>',
              footerTemplate,
              margin: { bottom: '48px', top: '20px', left: '0', right: '0' },
            }
          : {}),
      });
      return Buffer.from(pdf);
    } catch (error) {
      throw new ServiceUnavailableException('PDF_GENERATION_FAILED');
    } finally {
      await page?.close().catch(() => undefined);
      await browser?.close();
    }
  }
}
