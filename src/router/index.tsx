import { Route, Router } from "@solidjs/router";
import AppShell from "../components/AppShell";
import TokenEditor from "../components/TokenEditor";
import PreviewPanel from "../components/PreviewPanel";
import ComparePanel from "../components/ComparePanel";
import PendingPanel from "../components/PendingPanel";
import CollabStatusBar from "../components/CollabStatusBar";

function WorkspacePage() {
  return (
    <div class="flex h-full min-h-0 flex-col gap-3">
      <CollabStatusBar />
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(400px,0.9fr)_minmax(460px,1.1fr)_minmax(320px,0.8fr)] gap-4">
        <TokenEditor />
        <PreviewPanel />
        <PendingPanel />
      </div>
    </div>
  );
}

function ComparePage() {
  return (
    <div class="flex h-full min-h-0 flex-col gap-3">
      <CollabStatusBar />
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,0.7fr)] gap-4">
        <ComparePanel />
        <PendingPanel />
      </div>
    </div>
  );
}

export default function AppRouter() {
  return (
    <Router root={(props) => <AppShell>{props.children}</AppShell>}>
      <Route path="/" component={WorkspacePage} />
      <Route path="/compare" component={ComparePage} />
    </Router>
  );
}
