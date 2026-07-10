export function ComingSoon({ tabName }: { tabName: string }) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-16 text-center">
      <p className="text-sm text-muted">
        <span className="text-foreground font-medium">{tabName}</span> — coming in next session.
      </p>
    </div>
  );
}
