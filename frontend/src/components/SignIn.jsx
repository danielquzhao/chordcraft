import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const SignIn = () => {
    const { signInWithGoogle } = useAuth();
    const navigate = useNavigate();

    const handleSignIn = async () => {
        try {
            await signInWithGoogle();
            navigate('/keyboard');
        } catch (error) {
            console.error('Error signing in:', error);
        }
    };

    return (
        <div className="signin-content">
            <h1>Welcome to ChordCraft</h1>
            <p>Sign in to start creating music!</p>
            <button onClick={handleSignIn} className="signin-button">
                Sign in with Google
            </button>
        </div>
    );
};

export default SignIn; 