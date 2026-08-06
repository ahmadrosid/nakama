import { describe, expect, test } from "bun:test";
import {
  createAttachmentReference,
  verifyAttachmentReference,
} from "./attachment-reference";

process.env.NAKAMA_EMAIL_ATTACHMENT_SECRET ??= "test-email-attachment-secret-32-chars";

const context = {
  orgId: "org_test",
  profileId: "profile_test",
  sessionId: "session_test",
};

describe("email attachment references", () => {
  test("round-trips scoped claims", () => {
    const reference = createAttachmentReference(context, {
      folder: "INBOX",
      uid: 42,
      attachmentId: "0",
      mailboxId: "mailbox_test",
    });

    expect(verifyAttachmentReference(context, reference, "mailbox_test")).toMatchObject({
      folder: "INBOX",
      uid: 42,
      attachmentId: "0",
    });
  });

  test("rejects tampering and a different session", () => {
    const reference = createAttachmentReference(context, {
      folder: "INBOX",
      uid: 42,
      attachmentId: "0",
      mailboxId: "mailbox_test",
    });

    expect(() => verifyAttachmentReference(context, `${reference}x`, "mailbox_test")).toThrow(
      "Invalid email attachment reference.",
    );
    expect(() =>
      verifyAttachmentReference(context, `${reference}.extra`, "mailbox_test"),
    ).toThrow(
      "Invalid email attachment reference.",
    );
    expect(() =>
      verifyAttachmentReference({ ...context, sessionId: "other" }, reference, "mailbox_test"),
    ).toThrow("out of scope");
  });

  test("binds automation references to the automation run", () => {
    const automationContext = {
      orgId: "org_test",
      profileId: "profile_test",
      automationRunId: "run_test",
    };
    const reference = createAttachmentReference(automationContext, {
      folder: "INBOX",
      uid: 7,
      attachmentId: "1",
      mailboxId: "mailbox_test",
    });

    expect(verifyAttachmentReference(automationContext, reference, "mailbox_test").uid).toBe(7);
  });

  test("rejects a reference for a different mailbox", () => {
    const reference = createAttachmentReference(context, {
      folder: "INBOX",
      uid: 42,
      attachmentId: "0",
      mailboxId: "mailbox_test",
    });

    expect(() => verifyAttachmentReference(context, reference, "other_mailbox")).toThrow(
      "out of scope",
    );
  });
});
