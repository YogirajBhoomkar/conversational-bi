import './Message.css';

export default function UserMessage({ text }: { text: string }) {
  console.log("test", text);
  return (
    <div className="msg msg--user">
      <div className="msg__bubble">{text}</div>
    </div>
  );
}
