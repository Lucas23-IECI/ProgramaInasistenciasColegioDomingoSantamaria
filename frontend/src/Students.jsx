import './index.css';
import './styles/student-management.css';
import { useStudentsController } from './features/students/useStudentsController';
import { StudentsView } from './features/students/StudentsView';

function Students() {
  const controller = useStudentsController();
  return <StudentsView {...controller} />;
}

export default Students;
