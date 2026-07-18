import { redirect } from "next/navigation";

/** Root — middleware handles auth; authenticated users live in /dashboard. */
export default function Home() {
  redirect("/dashboard");
}
