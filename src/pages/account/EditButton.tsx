import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import { Button } from "antd";

/** A row's one control, as an icon: a pencil to change what's there, a plus when nothing is. */
export function EditButton({ label, adding = false, onClick }: { label: string; adding?: boolean; onClick: () => void }) {
  return <Button type="text" size="small" icon={adding ? <PlusOutlined /> : <EditOutlined />} aria-label={label} title={label} onClick={onClick} />;
}
