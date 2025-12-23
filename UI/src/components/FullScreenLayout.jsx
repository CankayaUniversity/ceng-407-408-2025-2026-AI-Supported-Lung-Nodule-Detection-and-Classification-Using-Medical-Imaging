import './Layout.css';

function FullScreenLayout({ children }) {
  return (
    <div className="layout">
      <div className="layout-container">
        <main className="main-content" style={{width:'100%'}}>
          {children}
        </main>
      </div>
    </div>
  );
}

export default FullScreenLayout;
