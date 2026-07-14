import { GameController } from "./game/GameController.js";
import { Scene } from "./game/Scene.js";
import { GameSocket } from "./net/wsClient.js";
import { LocalTransport } from "./net/localTransport.js";
import { wireHud } from "./ui/hud.js";
import "./style.css";

const isDemoMode = import.meta.env.VITE_DEMO_MODE === "true";
const wsUrl = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8787";

const transport = isDemoMode ? new LocalTransport() : new GameSocket(wsUrl);
const controller = new GameController(transport);
const scene = new Scene(controller);

function showDemoBanner(): void {
  const banner = document.createElement("div");
  banner.id = "demoBanner";
  banner.textContent =
    "DEMO BUILD — round outcomes are computed locally in your browser, not by a live server. Not representative of real-money play.";
  document.body.prepend(banner);
}

async function boot(): Promise<void> {
  if (isDemoMode) showDemoBanner();
  const host = document.getElementById("pixiHost");
  if (!host) throw new Error("missing #pixiHost");
  await scene.init(host);
  wireHud(controller);
  controller.start();
}

void boot();
