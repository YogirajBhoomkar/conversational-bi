import Button from "@mui/material/Button";
import GenieIcon from "../GenieIcon/GenieIcon";
import "./ChatHeader.css";

export default function ChatHeader({
  onNewChat,
  disabled,
}: {
  onNewChat: () => void;
  disabled: boolean;
}) {
  return (
    <header className="chat-header">
      <GenieIcon size={22} strokeWidth={3.5} />
      <h2 className="chat-header__title">Conversational BI AI</h2>
      <Button
        variant="outlined"
        className="chat-header__new"
        onClick={onNewChat}
        disabled={disabled}
        disableElevation
      >
        + New chat
      </Button>
    </header>
  );
}
