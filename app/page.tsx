import { redirect } from "next/navigation";
import { yesterdayInET } from "@/lib/dates";

export default function HomePage() {
  redirect(`/mlb/${yesterdayInET()}`);
}
