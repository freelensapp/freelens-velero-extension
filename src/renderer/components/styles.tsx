import inline from "./views.module.css?inline";

// The bundle of an extension has no style sheet of its own: every view carries its styles with it.
export function Styles() {
  return <style>{inline}</style>;
}
