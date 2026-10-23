// Options page: sets the gateway base URL into chrome.storage.sync.

import { getGatewayUrl, setGatewayUrl } from "./api.js";

async function init(): Promise<void> {
  const input = document.getElementById("gatewayUrl") as HTMLInputElement | null;
  const status = document.getElementById("status") as HTMLElement | null;
  const saveButton = document.getElementById("save");
  if (!input || !saveButton) return;

  input.value = await getGatewayUrl();

  saveButton.addEventListener("click", () => {
    void (async () => {
      const value = input.value.trim() || (await getGatewayUrl());
      await setGatewayUrl(value);
      if (status) {
        status.textContent = "Saved.";
        setTimeout(() => {
          status.textContent = "";
        }, 1500);
      }
    })();
  });
}

void init();
