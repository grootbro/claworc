import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import ThemeToggle from "./ThemeToggle";

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50 transition-colors duration-300">
      <Sidebar />
      <div className="fixed right-4 top-4 z-30">
        <ThemeToggle />
      </div>
      <main className="ml-16 min-h-screen px-4 sm:px-6 lg:px-8 pt-20 sm:pt-24 pb-4">
        <div className="max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
