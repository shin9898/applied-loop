declare module "page-flip" {
  export class PageFlip {
    constructor(element: HTMLElement, settings: Record<string, unknown>);
    loadFromHTML(items: HTMLElement[] | NodeListOf<Element>): void;
    updateFromHtml(items: HTMLElement[] | NodeListOf<Element>): void;
    flipNext(corner?: "top" | "bottom"): void;
    flipPrev(corner?: "top" | "bottom"): void;
    /** 指定ページへめくりアニメで遷移 */
    flip(page: number, corner?: "top" | "bottom"): void;
    turnToPage(page: number): void;
    turnToNextPage(): void;
    turnToPrevPage(): void;
    update(): void;
    destroy(): void;
    getCurrentPageIndex(): number;
    getPageCount(): number;
    getState(): string;
    on(
      event: string,
      callback: (e: { data: unknown; object: PageFlip }) => void,
    ): this;
    off(event: string): void;
  }
}
