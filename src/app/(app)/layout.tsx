import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { CommandPalette } from "@/components/layout/command-palette";
import { MissingKeyBanner } from "@/components/layout/missing-key-banner";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0">
        <MissingKeyBanner />
        {children}
      </SidebarInset>
      <CommandPalette />
    </SidebarProvider>
  );
}
