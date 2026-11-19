import { defineRule } from "@oxlint/plugins";

const deferralMarker = /\b(?:TODO|FIXME|HACK|XXX)\b/u;
const deferralPhrase =
  /\b(?:hacky|workarounds?|work[ -]around|for now|quick[ -]fix|band-?aid|kludge|stop-?gap|temporar(?:y|ily) (?:fix|hack|patch|solution|measure|disabl\w+|skip\w*))\b/iu;

/** Ban comments that excuse a shortcut instead of removing its cause. */
export const noHackCommentsRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow comments that mark deferred work or justify a shortcut; fix the cause or file an issue.",
    },
    messages: {
      hackComment:
        "This comment excuses a shortcut (`{{match}}`). Fix the root cause in this change. If the work is out of scope, file an issue and delete the comment.",
    },
  },
  createOnce(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const match = deferralMarker.exec(comment.value) ?? deferralPhrase.exec(comment.value);
          if (match !== null) {
            context.report({
              loc: comment.loc,
              messageId: "hackComment",
              data: { match: match[0] },
            });
          }
        }
      },
    };
  },
});
