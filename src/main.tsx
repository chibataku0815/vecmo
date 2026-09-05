import { App } from "@/app/App";
import "@/app/styles/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const rootElement = document.getElementById("root");

if (!rootElement) {
	throw new Error("Root element was not found.");
}

createRoot(rootElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
