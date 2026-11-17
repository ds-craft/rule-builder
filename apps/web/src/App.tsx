import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { DialogHost } from './ui/common/dialogs.tsx';
import { Toast } from './ui/common/Toast.tsx';
import { FileScreen } from './ui/file/FileScreen.tsx';
import { EditorScreen } from './ui/shell/EditorScreen.tsx';

// GitHub Pages で404にならないよう HashRouter を使う。#/file/:page と #/edit/:index の2系統。
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/file/:page" element={<FileScreen />} />
      <Route path="/edit/:index" element={<EditorScreen />} />
      <Route path="*" element={<Navigate to="/file/home" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <HashRouter>
      <AppRoutes />
      <DialogHost />
      <Toast />
    </HashRouter>
  );
}
