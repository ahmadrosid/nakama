import { describe, expect, test } from "bun:test";
import {
  createAttachmentReference,
  verifyAttachmentReference,
} from "./attachment-reference";

process.env.NAKAMA_EMAIL_ATTACHMENT_SECRET ??=
  "test-email-attachment-secret-32-chars";

const context = {
  orgId: "org_test",
  profileId: "profile_test",
  sessionId: "session_test",
};

describe("email attachment references", () => {
  test("round-trips scoped claims", () => {
    const reference = createAttachmentReference(context, {
      attachmentId: "0",
      folder: "INBOX",
      mailboxId: "mailbox_test",
      uid: 42,
    });

    expect(
      verifyAttachmentReference(context, reference, "mailbox_test")
    ).toMatchObject({
      attachmentId: "0",
      folder: "INBOX",
      uid: 42,
    });
  });

  test("rejects tampering and a different session", () => {
    const reference = createAttachmentReference(context, {
      attachmentId: "0",
      folder: "INBOX",
      mailboxId: "mailbox_test",
      uid: 42,
    });

    expect(() =>
      verifyAttachmentReference(context, `${reference}x`, "mailbox_test")
    ).toThrow("Invalid email attachment reference.");
    expect(() =>
      verifyAttachmentReference(context, `${reference}.extra`, "mailbox_test")
    ).toThrow("Invalid email attachment reference.");
    expect(() =>
      verifyAttachmentReference(
        { ...context, sessionId: "other" },
        reference,
        "mailbox_test"
      )
    ).toThrow("out of scope");
  });

  test("binds automation references to the automation run", () => {
    const automationContext = {
      automationRunId: "run_test",
      orgId: "org_test",
      profileId: "profile_test",
    };
    const reference = createAttachmentReference(automationContext, {
      attachmentId: "1",
      folder: "INBOX",
      mailboxId: "mailbox_test",
      uid: 7,
    });

    expect(
      verifyAttachmentReference(automationContext, reference, "mailbox_test")
        .uid
    ).toBe(7);
  });

  test("rejects a reference for a different mailbox", () => {
    const reference = createAttachmentReference(context, {
      attachmentId: "0",
      folder: "INBOX",
      mailboxId: "mailbox_test",
      uid: 42,
    });

    expect(() =>
      verifyAttachmentReference(context, reference, "other_mailbox")
    ).toThrow("out of scope");
  });
});
