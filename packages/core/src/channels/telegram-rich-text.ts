export function renderTelegramRichText(text: string): string {
  const protectedBlocks = protectFencedCodeBlocks(text.trim());
  const escapedText = escapeTelegramHtml(protectedBlocks.text);
  const formattedText = renderInlineTelegramFormatting(escapedText);

  return restoreProtectedBlocks(formattedText, protectedBlocks.blocks).trim();
}

function protectFencedCodeBlocks(text: string): { text: string; blocks: string[] } {
  const blocks: string[] = [];
  const protectedText = text.replace(/```[\w]*\n?([\s\S]*?)```/g, (_, code: string) => {
    const token = `@@TCTOKEN${blocks.length}@@`;
    blocks.push(`<pre><code>${escapeTelegramHtml(trimFenceNewlines(code))}</code></pre>`);
    return token;
  });

  return { text: protectedText, blocks };
}

function renderInlineTelegramFormatting(text: string): string {
  let result = text;

  result = result.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");
  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  result = result.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  result = result.replace(/__([^_]+)__/g, "<u>$1</u>");
  result = result.replace(/\*([^*]+)\*/g, "<i>$1</i>");
  result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s()]+)\)/g, renderLink);

  return result;
}

function renderLink(_: string, label: string, url: string): string {
  return `<a href="${escapeTelegramAttribute(url)}">${label}</a>`;
}

function restoreProtectedBlocks(text: string, blocks: string[]): string {
  let result = text;

  for (let index = 0; index < blocks.length; index++) {
    result = result.replace(`@@TCTOKEN${index}@@`, blocks[index]!);
  }

  return result;
}

function trimFenceNewlines(text: string): string {
  return text.replace(/^\n/, "").replace(/\n$/, "");
}

function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeTelegramAttribute(text: string): string {
  return text.replace(/"/g, "&quot;");
}
