import { createContext, useContext, useState, useEffect } from 'react';
import { authService } from '../services/auth';
import { toast } from 'react-toastify';

const AuthContext = createContext();

export function useAuth() {
    return useContext(AuthContext);
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    const signUp = async (email, password) => {
        try {
            const data = await authService.signUp(email, password);
            setUser(data.user);
            toast.success('Account created successfully!');
        } catch (error) {
            toast.error(error.response?.data?.message || error.message);
            throw error;
        }
    };

    const signIn = async (email, password) => {
        try {
            const data = await authService.signIn(email, password);
            setUser(data.user);
            toast.success('Signed in successfully!');
        } catch (error) {
            toast.error(error.response?.data?.message || error.message);
            throw error;
        }
    };

    const signOut = async () => {
        try {
            authService.signOut();
            setUser(null);
            toast.success('Signed out successfully!');
        } catch (error) {
            toast.error('Error signing out');
            console.error('Error signing out:', error);
        }
    };

    useEffect(() => {
        // Check if user is already logged in on mount
        const currentUser = authService.getCurrentUser();
        setUser(currentUser);
        setLoading(false);
    }, []);

    const value = {
        user,
        signUp,
        signIn,
        signOut
    };

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
} 