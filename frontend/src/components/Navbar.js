// components/Navbar.js
import React from 'react';
import './Navbar.css'; // Import a CSS file for Navbar styling
import logo from './ashoka-logo.png';
const Navbar = () => {
  return (
    <nav className="navbar">
        <div className='ashoka-logo-container'><img className="ashoka-logo" src={logo} alt="Ashoka University Logo"/>
        <div className="navbar-brand">Kutum Lab WSI Viewer</div>
        </div>
    </nav>
  );
};

export default Navbar;
