import { redirect } from "next/navigation";

// mock-spec.md 7章：/ は /login へリダイレクトする
export default function Home() {
  redirect("/login");
}
