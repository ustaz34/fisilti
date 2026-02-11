import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsApp } from "./components/SettingsApp";
import "./index.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { initThemeOnStartup } from "./lib/themeEngine";

// FOUC onleme: React render'dan once tema yukle
initThemeOnStartup();

function Root() {
  const windowLabel = getCurrentWindow().label;

  if (windowLabel === "main") {
    return <SettingsApp />;
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
