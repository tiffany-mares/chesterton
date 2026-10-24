import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Apply the saved theme before first paint to avoid a flash of wrong theme.
const saved = localStorage.getItem("chesterton.theme");
const dark =
  saved === "dark" ||
  ((saved === null || saved === "system") && window.matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.dataset.theme = dark ? "dark" : "light";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
