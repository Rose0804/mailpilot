import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MailPilotApp } from "./MailPilotApp";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MailPilotApp />
  </StrictMode>,
);
