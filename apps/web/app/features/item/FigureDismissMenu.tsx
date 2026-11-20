import { IconClose } from "../../components/icons";
import { Menu, MenuItem } from "../../components/ui/Menu";

export default function FigureDismissMenu({ onHide }: { onHide: (all: boolean) => void }) {
  return (
    <Menu label="关闭图表提示" trigger={<IconClose size={18} />}>
      {(close) => (
        <>
          <MenuItem onSelect={() => { close(); onHide(false); }}>本次关闭直到下次访问</MenuItem>
          <MenuItem onSelect={() => { close(); onHide(true); }}>永久禁用</MenuItem>
        </>
      )}
    </Menu>
  );
}
