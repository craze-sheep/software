import { Navigate, createBrowserRouter } from "react-router-dom";

import { AppLayout } from "./layouts/AppLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { UploadPage } from "./pages/UploadPage";
import { AdjustmentPage } from "./pages/AdjustmentPage";
import { ComparisonPage } from "./pages/ComparisonPage";
import { ReportPage } from "./pages/ReportPage";
import { AutoEnhancePage } from "./pages/AutoEnhancePage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "upload", element: <UploadPage /> },
      { path: "auto", element: <AutoEnhancePage /> },
      { path: "adjustment", element: <AdjustmentPage /> },
      { path: "comparison", element: <ComparisonPage /> },
      { path: "report", element: <ReportPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);
