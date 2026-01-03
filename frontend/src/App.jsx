import { useState, useEffect, useRef } from "react";
import Keyboard from "./components/keyboard";
import Saved from "./components/saved";
import ABCJS from "abcjs";
import { Routes, Route, BrowserRouter, Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import "./style/keyboard.css";
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import AuthModal from "./components/AuthModal";

// Create a separate KeyboardPage component
function KeyboardPage({ activeKeys, keyMap, abcNotation, onClear, setIsModalOpen, isModalOpen, setIsOnKeyboardPage }) {
    useEffect(() => {
        // Set keyboard page as active when component mounts
        setIsOnKeyboardPage(true);

        return () => {
            // Set keyboard page as inactive when component unmounts
            setIsOnKeyboardPage(false);
        };
    }, [setIsOnKeyboardPage]);

    useEffect(() => {
        // Render the sheet music with existing notation when component mounts
        const abcString = `X:1
M:4/4
L:1/4
K:C
${abcNotation}`;

        ABCJS.renderAbc("sheet-music", abcString, {
            responsive: 'resize',
            wrap: {
                preferredMeasuresPerLine: 4,
                minSpacing: 2.7,
                maxSpacing: 3.0
            },
            staffwidth: 800,
            format: {
                gchordfont: "italic 12px Arial",
                measurebox: true,
                breaklimit: 4
            }
        });
    }, [abcNotation]); // Re-render when notation changes

    return (
        <div className="keyboard-content">
            <h1>Live Sheet Music</h1>
            <div id="sheet-music"></div>
            <Keyboard
                activeKeys={activeKeys}
                keyMap={keyMap}
                onClear={onClear}
                abcNotation={abcNotation}
                setIsModalOpen={setIsModalOpen}
                isModalOpen={isModalOpen}
            />
        </div>
    );
}

function PrivateRoute({ children }) {
    const { user } = useAuth();
    return user ? children : <Navigate to="/" />;
}

function Navigation() {
    const { user, signOut } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

    // Don't show navbar on home page if not logged in
    if (!user && location.pathname === '/') {
        return (
            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
            />
        );
    }

    const handleSignOut = async () => {
        try {
            await signOut();
            navigate('/');
        } catch (error) {
            console.error('Error signing out:', error);
        }
    };

    return (
        <>
            <nav>
                {user ? (
                    <>
                        <Link to="/keyboard">Keyboard</Link> |{" "}
                        <Link to="/saved">Saved</Link> |{" "}
                        <button onClick={handleSignOut} className="signout-button">
                            Sign Out
                        </button>
                    </>
                ) : (
                    <>
                        <Link to="/">Home</Link> |{" "}

                        <button
                            onClick={() => setIsAuthModalOpen(true)}
                            className="nav-button"
                        >
                            Sign In
                        </button>
                    </>

                )}
            </nav>
            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
            />
        </>
    );
}

// Wrap Navigation in a separate component to use hooks
function NavigationWrapper() {
    return <Navigation />;
}

function App() {
    const [activeKeys, setActiveKeys] = useState([]);
    const [abcNotation, setAbcNotation] = useState("");
    const debounceTimer = useRef(null); // Timer for debouncing
    const [heldKeys, setHeldKeys] = useState(new Set()); // Add this state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isKeyboardEnabled, setIsKeyboardEnabled] = useState(true);
    const [isOnKeyboardPage, setIsOnKeyboardPage] = useState(false); // Add this state

    const keyMap = {
        a: "C", // Middle C
        w: "^C", // C#
        s: "D", // D
        e: "^D", // D#
        d: "E", // E
        f: "F", // F
        t: "^F", // F#
        g: "G", // G
        y: "^G", // G#
        h: "A", // A
        u: "^A", // A#
        j: "B", // B
        k: "c", // High C
        o: "^c", // High C#
        l: "d", // High D
        p: "^d", // High D#
        ";": "e", // High E
    };

    const fileNameMap = {
        C: "C1",
        "^C": "Csh1",
        D: "D1",
        "^D": "Dsh1",
        E: "E1",
        F: "F1",
        "^F": "Fsh1",
        G: "G1",
        "^G": "Gsh1",
        A: "A1",
        "^A": "Ash1",
        B: "B1",
        c: "C2",
        "^c": "Csh2",
        d: "D2",
        "^d": "Dsh2",
        e: "E2",
    };

    const playSound = (notes) => {
        if (notes.length === 1) {
            // Play a single note
            const note = notes[0];
            const soundFile = fileNameMap[note];
            if (soundFile) {
                const audio = new Audio(`/sounds/${soundFile}.mp3`);
                audio.play();
            }
        } else {
            // Handle chords (optional: implement combined chord sounds)
            notes.forEach((note) => {
                const soundFile = fileNameMap[note];
                if (soundFile) {
                    const audio = new Audio(`/sounds/${soundFile}.mp3`);
                    audio.play();
                }
            });
        }
    };

    const handleKeyDown = (event) => {
        // If we're on keyboard page but modal is open, or keyboard is disabled, don't handle piano events
        if (!isOnKeyboardPage || !isKeyboardEnabled || isModalOpen) return;

        // Check if we're typing in an input or textarea
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

        // Prevent key repeat
        if (event.repeat || heldKeys.has(event.key)) return;

        const note = keyMap[event.key];
        if (note && !activeKeys.includes(note)) {
            setHeldKeys(prev => new Set([...prev, event.key]));
            setActiveKeys((prev) => [...prev, note]);

            // Clear the existing debounce timer
            if (debounceTimer.current) {
                clearTimeout(debounceTimer.current);
            }

            // Set a new debounce timer
            debounceTimer.current = setTimeout(() => {
                // Play sound and update ABC notation as a chord
                const sortedKeys = [...activeKeys, note].sort();
                const chord = `[${sortedKeys.join(" ")}]`; // Format as a chord

                // Add bar line after every 4 beats (notes or chords)
                setAbcNotation((prev) => {
                    // Split into individual elements but preserve chords as single units
                    const elements = prev.match(/\[[^\]]+\]|[^\s|]+/g) || [];
                    const newElements = [...elements, chord];

                    // Group into measures of 4 beats (each element counts as 1 beat)
                    return newElements.reduce((acc, element, index) => {
                        if (index > 0 && index % 4 === 0) {
                            return `${acc} | ${element}`;
                        }
                        return `${acc} ${element}`;
                    }, '').trim() + (newElements.length % 4 === 0 ? ' |' : '');
                });

                playSound(sortedKeys); // Play all notes in the chord
                setActiveKeys([]); // Reset active keys after playing the chord
            }, 200); // 200ms debounce delay
        }
    };

    const handleKeyUp = (event) => {
        // If modal is open or typing in form fields, don't handle piano events
        if (!isOnKeyboardPage || isModalOpen) return;

        // Check if we're typing in an input or textarea
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

        const note = keyMap[event.key];
        if (note) {
            setHeldKeys(prev => {
                const newSet = new Set(prev);
                newSet.delete(event.key);
                return newSet;
            });
            setActiveKeys((prev) => prev.filter((key) => key !== note));
        }
    };

    useEffect(() => {
        // Only add event listeners if we're on the keyboard page
        if (isOnKeyboardPage) {
            window.addEventListener("keydown", handleKeyDown);
            window.addEventListener("keyup", handleKeyUp);

            return () => {
                window.removeEventListener("keydown", handleKeyDown);
                window.removeEventListener("keyup", handleKeyUp);
            };
        }
    }, [activeKeys, isOnKeyboardPage]); // Add isOnKeyboardPage to dependencies

    const clearSheetMusic = () => {
        setAbcNotation("");
    };

    const handleSetModalOpen = (value) => {
        setIsModalOpen(value);
        setIsKeyboardEnabled(!value);  // Disable keyboard when modal opens
    };

    return (
        <BrowserRouter>
            <AuthProvider>
                <div className="app-container">
                    <NavigationWrapper />

                    <Routes>
                        <Route path="/" element={<Home />} />
                        <Route
                            path="/keyboard"
                            element={
                                <PrivateRoute>
                                    <KeyboardPage
                                        activeKeys={activeKeys}
                                        keyMap={keyMap}
                                        abcNotation={abcNotation}
                                        onClear={clearSheetMusic}
                                        setIsModalOpen={handleSetModalOpen}
                                        isModalOpen={isModalOpen}
                                        setIsOnKeyboardPage={setIsOnKeyboardPage}
                                    />
                                </PrivateRoute>
                            }
                        />
                        <Route
                            path="/saved"
                            element={
                                <PrivateRoute>
                                    <Saved />
                                </PrivateRoute>
                            }
                        />
                    </Routes>

                    <ToastContainer
                        position="bottom-right"
                        autoClose={3000}
                        hideProgressBar={false}
                        newestOnTop={false}
                        closeOnClick
                        rtl={false}
                        pauseOnFocusLoss
                        draggable
                        pauseOnHover
                        theme="dark"
                    />
                </div>
            </AuthProvider>
        </BrowserRouter>
    );
}

function Home() {
    const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
    const { user } = useAuth();
    const navigate = useNavigate();

    return (
        <div className="home-content">
            <div className="logo-top-left">ChordCraft 🎵</div>

            <div className="hero-text">
                <h1>Your intelligent <br />musical companion</h1>
                <p className="hero-subtitle">
                    Transform your piano performances into professional sheet music instantly.
                    ChordCraft is the real-time assistant for composers and students.
                </p>
                {!user ? (
                    <button
                        onClick={() => setIsAuthModalOpen(true)}
                        className="get-started-btn"
                    >
                        Get started <span className="arrow">→</span>
                    </button>
                ) : (
                    <button
                        onClick={() => navigate('/keyboard')}
                        className="get-started-btn"
                    >
                        Go to Keyboard <span className="arrow">→</span>
                    </button>
                )}
            </div>

            <AuthModal
                isOpen={isAuthModalOpen}
                onClose={() => setIsAuthModalOpen(false)}
            />
        </div>
    );
}

export default App;
