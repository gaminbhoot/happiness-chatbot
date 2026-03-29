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
        <Route path="/ai/1" element={<Navigate to="/ai/1.pdf" />} />
        <Route path="/ai/2" element={<Navigate to="/ai/2.pdf" />} />
        <Route path="/ai/3" element={<Navigate to="/ai/3.pdf" />} />
        <Route path="/ai/4" element={<Navigate to="/ai/4.pdf" />} />
        <Route path="/ai/5" element={<Navigate to="/ai/5.pdf" />} />
        <Route path="/ai/6" element={<Navigate to="/ai/6.pdf" />} />
        <Route path="/ai/7" element={<Navigate to="/ai/7.pdf" />} />
        <Route path="/ai/8" element={<Navigate to="/ai/8.pdf" />} />
        <Route path="/ai/9" element={<Navigate to="/ai/9.pdf" />} />
        <Route path="/ai/10" element={<Navigate to="/ai/10.pdf" />} />
                <Route path="/ai/1" element={<Navigate to="/ai/1.pdf" />} />
        <Route path="/2" element={<Navigate to="/ai/2.pdf" />} />
        <Route path="/3" element={<Navigate to="/ai/3.pdf" />} />
        <Route path="/4" element={<Navigate to="/ai/4.pdf" />} />
        <Route path="/5" element={<Navigate to="/ai/5.pdf" />} />
        <Route path="/6" element={<Navigate to="/ai/6.pdf" />} />
        <Route path="/7" element={<Navigate to="/ai/7.pdf" />} />
        <Route path="/8" element={<Navigate to="/ai/8.pdf" />} />
        <Route path="/9" element={<Navigate to="/ai/9.pdf" />} />
        <Route path="/10" element={<Navigate to="/ai/10.pdf" />} />

      </Routes>
    </BrowserRouter>
  );
}

export default App;
