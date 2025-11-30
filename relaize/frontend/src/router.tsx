import { Navigate, createBrowserRouter } from "react-router-dom";

import { AppLayout } from "./layouts/AppLayout";
import { UploadPage } from "./pages/UploadPage";
import { AdjustmentPage } from "./pages/AdjustmentPage";
import { ComparisonPage } from "./pages/ComparisonPage";
import { ReportPage } from "./pages/ReportPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="upload" replace /> },
      { path: "upload", element: <UploadPage /> },
      { path: "adjustment", element: <AdjustmentPage /> },
      { path: "comparison", element: <ComparisonPage /> },
      { path: "report", element: <ReportPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/upload" replace /> },
]);
