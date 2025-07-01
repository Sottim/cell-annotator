// components/Navbar.js
import React from 'react';
import './Navbar.css'; // Import a CSS file for Navbar styling
import logo from './ashoka-logo.png';
import ahsLogo from './AHSLOGO.png';

const Navbar = () => {
  return (
    <nav className="navbar">
      <div className='ashoka-logo-container'><img className="ashoka-logo" src={logo} alt="Ashoka University Logo" />
        <div className="navbar-brand">Augumented Health Systems : Whole Slide Image Viewer</div>
      </div>
      <div className="navbar-logo-right">
        <img src={ahsLogo} alt="AHS Logo" className="ahs-logo" style={{ height: '95px', width: 'auto', objectFit: 'contain' }} />
      </div>
    </nav>
  );
};

export default Navbar;
