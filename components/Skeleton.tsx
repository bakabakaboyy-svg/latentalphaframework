export function SkeletonRow() {
  return (
    <div className="skeleton rounded-md h-16 w-full" />
  );
}

export function SkeletonTable() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 7 }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  );
}
