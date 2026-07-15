import React from 'react';
import { NavLink } from 'react-router-dom';
import { Utensils, Users } from 'lucide-react';

function Nav() {
  return (
    <nav className="main-nav">
      <NavLink to="/" end className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}>
        <Utensils size={18} />
        <span>Registro</span>
      </NavLink>
      <NavLink to="/estudiantes" className={({ isActive }) => `nav-tab ${isActive ? 'active' : ''}`}>
        <Users size={18} />
        <span>Estudiantes</span>
      </NavLink>
    </nav>
  );
}

export default Nav;
