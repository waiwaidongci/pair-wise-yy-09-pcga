import { Route, Router } from "@solidjs/router";
import AppShell from "../components/AppShell";
import TokenEditor from "../components/TokenEditor";
import PreviewPanel from "../components/PreviewPanel";
import ComparePanel from "../components/ComparePanel";

function WorkspacePage() {
  return (
    <div class="grid h-full min-h-0 grid-cols-[minmax(430px,0.9fr)_minmax(520px,1.1fr)] gap-4">
      <TokenEditor />
      <PreviewPanel />
    </div>
  );
}

export default function AppRouter() {
  return (
    <Router root={(props) => <AppShell>{props.children}</AppShell>}>
      <Route path="/" component={WorkspacePage} />
      <Route path="/compare" component={ComparePanel} />
    </Router>
  );
}
