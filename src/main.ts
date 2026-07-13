import { Buffer } from "buffer";
import "@annadata/pack-it-pkc/assets/katex/katex.css";

import { initTitleBar } from "./ui/title-bar";
import { initTabBar } from "./ui/tab-bar";
import { initSettingsModal, initInfoModal, loadPrefs } from "./ui/settings-modal";
import {
  initConvert,
  updateColorToggleUi,
  updateGgufModelStatus,
} from "./convert/process";
import { state } from "./convert/app-state";
import { getActiveModelId } from "@annadata/pack-it-pkc";
import pkg from "../package.json";

(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;

const prefs = loadPrefs();
state.packPkcOnProcess = prefs.packPkc;
state.imageColorMode = prefs.colorMode;

initTitleBar();
initTabBar();
initInfoModal(pkg.version);

initSettingsModal({
  getActiveModelLabel: () => getActiveModelId() || "—",
  onSave: (next) => {
    state.packPkcOnProcess = next.packPkc;
    state.imageColorMode = next.colorMode;
    const pkcToggle = document.getElementById("pkc-toggle") as HTMLInputElement;
    pkcToggle.checked = next.packPkc;
    updateColorToggleUi();
    updateGgufModelStatus();
  },
});

void initConvert();
