import { GameController } from "./game/GameController.js";
import { Scene } from "./game/Scene.js";
import { wireHud } from "./ui/hud.js";
import "./style.css";

const wsUrl = (import.meta.env.VITE_WS_URL as string | undefined) ?? "ws://localhost:8787";

const controller = new GameController(wsUrl);
const scene = new Scene(controller);

async function boot(): Promise<void> {
  const host = document.getElementById("pixiHost");
  if (!host) throw new Error("missing #pixiHost");
  await scene.init(host);
  wireHud(controller);
  controller.start();
}

void boot();
