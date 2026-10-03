const button = document.querySelector("#allow");
const status = document.querySelector("#status");
button.onclick = async () => {
  button.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) {
      track.stop();
    }
    button.hidden = true;
    status.textContent =
      "Microphone allowed. Return to your Meet tab and start transcription again. You can close this tab.";
  } catch {
    status.textContent =
      "Microphone access was blocked. Allow it in this tab’s site settings, then try again.";
    button.disabled = false;
  }
};
