import { BrowserRouter, Routes, Route,Navigate } from "react-router-dom";
import { GoogleGeminiEffectDemo } from "./Home";
import Chatbot from "./components/ui/Chatbot";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* <Route path="/" element={<GoogleGeminiEffectDemo />} /> */}
        <Route path="/" element={<Chatbot />} />
        <Route path="/chat" element={<Chatbot />} />
        <Route path="/ai" element={<Navigate to="/ai/index.pdf" />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
