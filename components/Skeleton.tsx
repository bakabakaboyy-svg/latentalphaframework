export function SkeletonRow() {
  return (
    <div className="skeleton rounded-md h-16 w-full" />
  );
}

export function SkeletonTable() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2, 3].map((i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
