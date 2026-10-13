import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

const copyMatchers = new Set(["toContain", "toMatch", "toThrow"]);
const minimumWords = 3;

function copyText(node: ESTree.Node): string | null {
  if (node.type === "Literal") {
    if ("regex" in node && node.regex) return node.regex.pattern;
    return typeof node.value === "string" ? node.value : null;
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("");
  }
  return null;
}

function isProse(text: string): boolean {
  return text.split(/\s+/).filter((word) => /[A-Za-z]{2,}/.test(word)).length >= minimumWords;
}

/** Ban assertions that pin a sentence of prompt, description, or error copy. */
export const noCopyAssertionsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow toContain, toMatch, and toThrow with a prose string; assert status, data, or side effects.",
    },
    messages: {
      copyAssertion:
        "Assert behavior (status, data, side effects), not copy. Check an error type or code, or a structured field.",
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier" || !copyMatchers.has(callee.property.name)) return;
        const argument = node.arguments[0];
        if (argument === undefined || argument.type === "SpreadElement") return;
        const text = copyText(argument);
        if (text !== null && isProse(text)) {
          context.report({ node: argument, messageId: "copyAssertion" });
        }
      },
    };
  },
});
