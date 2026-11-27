/**
 * Height the open dialog needs. In the small job window the dialog is stretched to the window, so
 * its own height says nothing; the header, the body's content and the footer are added up instead.
 */
export function dialogContentHeight(): number | null {
  // The compression result/error dialog is one padded column: up to its footer plus the padding.
  const operation = document.querySelector<HTMLElement>(".zip-operation-dialog");
  const operationFooter = operation?.querySelector<HTMLElement>("footer");
  if (operation && operationFooter) {
    const bottom = operationFooter.getBoundingClientRect().bottom - operation.getBoundingClientRect().top;
    return Math.ceil(bottom + parseFloat(getComputedStyle(operation).paddingBottom));
  }
  const dialog = document.querySelector<HTMLElement>(".workbench-confirm-dialog");
  const header = dialog?.querySelector<HTMLElement>(".workbench-confirm-dialog__header");
  const body = dialog?.querySelector<HTMLElement>(".workbench-confirm-dialog__body");
  const footer = dialog?.querySelector<HTMLElement>(".workbench-confirm-dialog__footer");
  const last = body?.lastElementChild;
  if (!header || !body || !footer || !last) return null;
  const content = last.getBoundingClientRect().bottom - body.getBoundingClientRect().top + body.scrollTop;
  return Math.ceil(header.offsetHeight + content + parseFloat(getComputedStyle(body).paddingBottom) + footer.offsetHeight);
}
