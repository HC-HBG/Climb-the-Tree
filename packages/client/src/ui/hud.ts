import type { GameController } from "../game/GameController.js";
import { centsToDisplay, displayToCents, formatMultiplier } from "../format.js";
import logoUrl from "../assets/logo.png";

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function wireHud(controller: GameController): void {
  const betInput = $<HTMLInputElement>("betInput");
  const betShow = $<HTMLSpanElement>("betShow");
  const betMinus = $<HTMLButtonElement>("betMinus");
  const betPlus = $<HTMLButtonElement>("betPlus");
  const quickButtons = document.querySelectorAll<HTMLButtonElement>(".quick button");

  const autoInput = $<HTMLInputElement>("autoInput");
  const autoToggle = $<HTMLButtonElement>("autoToggle");

  const mainBtn = $<HTMLButtonElement>("mainBtn");
  const balShow = $<HTMLElement>("balShow");

  const bigMultiplier = $<HTMLDivElement>("bigMultiplier");
  const banner = $<HTMLDivElement>("banner");

  const statCurrent = $<HTMLSpanElement>("statCurrent");
  const statHighest = $<HTMLSpanElement>("statHighest");

  const historyEl = $<HTMLDivElement>("history");

  const pfBtn = $<HTMLButtonElement>("pfBtn");
  const pfModal = $<HTMLDivElement>("pfModal");
  const pfClose = $<HTMLButtonElement>("pfClose");
  const pfHash = $<HTMLDivElement>("pfHash");
  const pfNonce = $<HTMLSpanElement>("pfNonce");
  const pfClient = $<HTMLInputElement>("pfClient");
  const pfRotate = $<HTMLButtonElement>("pfRotate");

  $<HTMLImageElement>("logoImg").src = logoUrl;

  let toastEl = document.getElementById("toast");
  if (!toastEl) {
    toastEl = document.createElement("div");
    toastEl.id = "toast";
    document.body.appendChild(toastEl);
  }
  const toast = toastEl;
  let lastErrorShown: string | undefined;

  betInput.addEventListener("change", () => {
    const cents = displayToCents(betInput.value);
    if (cents === null) {
      betInput.value = centsToDisplay(controller.getSnapshot().betCents);
      return;
    }
    controller.setBetCents(cents);
  });
  betMinus.addEventListener("click", () => controller.stepBetDown());
  betPlus.addEventListener("click", () => controller.stepBetUp());
  quickButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.q === "half") controller.quickHalf();
      if (btn.dataset.q === "dbl") controller.quickDouble();
      if (btn.dataset.q === "max") controller.quickMax();
    });
  });

  autoToggle.addEventListener("click", () => controller.toggleAuto());
  autoInput.addEventListener("change", () => {
    const value = Number.parseFloat(autoInput.value);
    if (!Number.isFinite(value)) {
      autoInput.value = (controller.getSnapshot().autoXHundredths / 100).toFixed(2);
      return;
    }
    controller.setAutoX(value);
  });

  mainBtn.addEventListener("click", () => controller.pressMain());
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && document.activeElement?.tagName !== "INPUT") {
      e.preventDefault();
      controller.pressMain();
    }
  });

  pfBtn.addEventListener("click", () => pfModal.classList.add("open"));
  pfClose.addEventListener("click", () => pfModal.classList.remove("open"));
  pfClient.addEventListener("change", () => controller.setClientSeed(pfClient.value || "default"));
  pfRotate.addEventListener("click", () => controller.rotateSeed());

  function render(): void {
    const snap = controller.getSnapshot();

    balShow.textContent = `🪙 ${centsToDisplay(snap.balanceCents)}`;
    betShow.textContent = `🪙 ${centsToDisplay(snap.betCents)}`;

    const betControlsEnabled = snap.state === "IDLE";
    betInput.disabled = !betControlsEnabled;
    betMinus.disabled = !betControlsEnabled;
    betPlus.disabled = !betControlsEnabled;
    quickButtons.forEach((b) => (b.disabled = !betControlsEnabled));
    if (document.activeElement !== betInput) {
      betInput.value = centsToDisplay(snap.betCents);
    }

    autoToggle.textContent = snap.autoOn ? "ON" : "OFF";
    autoToggle.classList.toggle("on", snap.autoOn);
    if (document.activeElement !== autoInput) {
      autoInput.value = (snap.autoXHundredths / 100).toFixed(2);
    }

    if (snap.state === "CLIMBING") {
      mainBtn.classList.add("cash");
      const liveWinCents = Math.floor(snap.betCents * snap.currentMultiplier);
      mainBtn.innerHTML = `CASH OUT ${formatMultiplier(snap.currentMultiplier)}<span class="sub">🪙 ${centsToDisplay(liveWinCents)}</span>`;
      mainBtn.disabled = false;
    } else {
      mainBtn.classList.remove("cash");
      mainBtn.innerHTML = `CLIMB<span class="sub">🪙 ${centsToDisplay(snap.betCents)}</span>`;
      mainBtn.disabled =
        snap.state !== "IDLE" ||
        snap.betCents > snap.balanceCents ||
        snap.betCents < controller.config.minBetCents;
    }

    bigMultiplier.className = "";
    banner.className = "";
    banner.textContent = "";
    if (snap.state === "CLIMBING") {
      bigMultiplier.textContent = formatMultiplier(snap.currentMultiplier);
    } else if (snap.state === "CASHED" && snap.cashResult) {
      bigMultiplier.textContent = formatMultiplier(snap.cashResult.x);
      bigMultiplier.classList.add("cashed");
      banner.classList.add("cashed");
      banner.textContent = `WIN 🪙 ${centsToDisplay(snap.cashResult.winCents)}`;
    } else if (snap.state === "CRASHED" && snap.crashResult) {
      bigMultiplier.textContent = formatMultiplier(snap.crashResult.crash);
      bigMultiplier.classList.add("crashed");
      banner.classList.add("crashed");
      banner.textContent = snap.crashResult.crash === 1 ? "BRANCH SNAPPED!" : "HE FELL!";
    } else {
      bigMultiplier.textContent = "";
    }

    const displayX =
      snap.state === "CASHED" && snap.cashResult ? snap.cashResult.x : snap.currentMultiplier;
    statCurrent.textContent = formatMultiplier(displayX);
    statHighest.textContent = formatMultiplier(snap.highestCashedX);

    historyEl.innerHTML = snap.history
      .map((h) => {
        const tier = h.crash < 2 ? "r" : h.crash < 10 ? "y" : "g";
        return `<span class="chip ${tier}">${formatMultiplier(h.crash)}</span>`;
      })
      .join("");

    pfHash.textContent = snap.seedHash || "…";
    pfNonce.textContent = String(snap.nonce);

    if (snap.lastError && snap.lastError.message !== lastErrorShown) {
      lastErrorShown = snap.lastError.message;
      toast.textContent = snap.lastError.message;
      toast.classList.add("show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
    }
  }

  controller.subscribe(render);
  render();
}
