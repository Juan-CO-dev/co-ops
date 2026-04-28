import { PlaceholderCard } from "@/components/PlaceholderCard";

export default function LtoPage() {
  return (
    <PlaceholderCard
      title="LTO Performance"
      description="Per-LTO sales, food cost, and customer rating tracking."
      features={[
        "Units sold + revenue per LTO",
        "Food cost % calculation",
        "Customer rating average",
        "Compare across locations and time windows",
      ]}
      shippingIn="Module #17 (LTO Performance)"
    />
  );
}
