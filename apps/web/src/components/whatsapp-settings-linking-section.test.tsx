import { expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { WhatsAppSettingsLinkingSection } from "./whatsapp-settings-linking-section";

test("relinking a paired account requires confirmation", async () => {
  const reconnect = mock(() => {});
  const regenerate = mock(() => {});
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const click = async (label: string) => {
    const button = [...document.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === label
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
  };
  try {
    await act(async () =>
      root.render(
        <WhatsAppSettingsLinkingSection
          awaitingQr={false}
          bridgeStarting={false}
          copied={false}
          linkingAfterScan={false}
          onCopyPairingCode={() => {}}
          onReconnect={reconnect}
          onRegeneratePairingCode={regenerate}
          paired
          pairingCode={null}
          qrCode={null}
          reconnectPending={false}
          regeneratePending={false}
          savePending={false}
          showQr={false}
          showReconnect
        />
      )
    );
    await click("Scan a new QR code");
    expect(reconnect).not.toHaveBeenCalled();
    await click("Cancel");
    expect(reconnect).not.toHaveBeenCalled();
    await click("Scan a new QR code");
    await click("Relink WhatsApp");
    expect(reconnect).toHaveBeenCalledTimes(1);
    await click("New code");
    expect(regenerate).not.toHaveBeenCalled();
    await click("Relink WhatsApp");
    expect(regenerate).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
