import './Layout.css';

function FullScreenLayout({ children }) {
  return (
    <div className="layout">
      <main className="main-content full-screen">
        {children}
      </main>
    </div>
  );
}

export default FullScreenLayout;
