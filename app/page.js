"use client";
import { useEffect, useRef, useState } from "react";

export default function VideoCall() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const pcRef = useRef(null);
  const wsRef = useRef(null);
  const [localStream, setLocalStream] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [localAudioEnabled, setLocalAudioEnabled] = useState(true);
  const [localVideoEnabled, setLocalVideoEnabled] = useState(true);
  const [status, setStatus] = useState("Initializing...");
  const [partnerId, setPartnerId] = useState(null);
  const [myId, setMyId] = useState(null);

  useEffect(() => {
    initializeCall();
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    if (wsRef.current) wsRef.current.close();
    if (pcRef.current) pcRef.current.close();
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
  };

  const initializeCall = async () => {
    try {
      const userId = `user_${Math.random().toString(36).substr(2, 9)}`;
      setMyId(userId);

      // Connect to your signaling server (replace with your actual server)
      const ws = new WebSocket('ws://localhost:8080');
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("Finding a partner...");
        ws.send(JSON.stringify({ 
          type: 'find-partner',
          userId: userId
        }));
      };

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.type) {
          case 'partner-found':
            setStatus("Partner found! Connecting...");
            setPartnerId(data.partnerId);
            await setupWebRTC();
            if (data.initiator) {
              await createOffer();
            }
            break;
          
          case 'offer':
            await handleOffer(data.offer);
            break;
          
          case 'answer':
            await handleAnswer(data.answer);
            break;
          
          case 'ice-candidate':
            await handleIceCandidate(data.candidate);
            break;
          
          case 'partner-disconnected':
            setStatus("Partner disconnected. Finding new partner...");
            setIsConnected(false);
            setPartnerId(null);
            // Auto find new partner
            setTimeout(() => {
              ws.send(JSON.stringify({ 
                type: 'find-partner',
                userId: userId
              }));
            }, 2000);
            break;
        }
      };

      ws.onerror = () => setStatus("Connection error");
      ws.onclose = () => setStatus("Disconnected from server");

    } catch (error) {
      setStatus("Error: " + error.message);
    }
  };

  const setupWebRTC = async () => {
    try {
      setIsConnecting(true);

      // Get user media first
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 },
          facingMode: "user"
        },
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      // Fetch TURN servers from Metered.ca
      const iceServers = await fetchMeteredServers();

      // Create peer connection with Metered.ca TURN servers
      const pc = new RTCPeerConnection({
        iceServers: iceServers,
        iceCandidatePoolSize: 10
      });
      pcRef.current = pc;

      // Add tracks to peer connection
      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      // Handle incoming tracks
      pc.ontrack = (event) => {
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
          setIsConnected(true);
          setIsConnecting(false);
          setStatus("Connected");
        }
      };

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate && wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'ice-candidate',
            candidate: event.candidate
          }));
        }
      };

      // Handle connection state changes
      pc.oniceconnectionstatechange = () => {
        console.log('ICE Connection State:', pc.iceConnectionState);
        if (pc.iceConnectionState === 'connected') {
          setIsConnected(true);
          setStatus("Connected");
        } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          setIsConnected(false);
          setStatus("Connection lost");
        }
      };

      pc.onconnectionstatechange = () => {
        console.log('Connection State:', pc.connectionState);
      };

    } catch (error) {
      setStatus("Camera/Mic access denied");
      setIsConnecting(false);
      console.error("Setup error:", error);
    }
  };

  // Fetch TURN servers from Metered.ca
  const fetchMeteredServers = async () => {
    try {
      const response = await fetch(
        "https://videoamexan.metered.live/api/v1/turn/credentials?apiKey=7e093594fec298edaac63a02a2ce931f5f55"
      );
      
      if (response.ok) {
        const servers = await response.json();
        console.log("✅ Loaded Metered.ca TURN servers from API");
        return servers;
      }
    } catch (error) {
      console.log("⚠️ Metered.ca API failed, using hardcoded credentials");
    }

    // Fallback to hardcoded Metered.ca credentials
    return [
      {
        urls: "stun:stun.relay.metered.ca:80",
      },
      {
        urls: "turn:global.relay.metered.ca:80",
        username: "4b71bece57147d0a4cf7f62b",
        credential: "cRhpdVg4vumYTfZi",
      },
      {
        urls: "turn:global.relay.metered.ca:80?transport=tcp",
        username: "4b71bece57147d0a4cf7f62b",
        credential: "cRhpdVg4vumYTfZi",
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username: "4b71bece57147d0a4cf7f62b",
        credential: "cRhpdVg4vumYTfZi",
      },
      {
        urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username: "4b71bece57147d0a4cf7f62b",
        credential: "cRhpdVg4vumYTfZi",
      },
    ];
  };

  const createOffer = async () => {
    const pc = pcRef.current;
    if (!pc) return;

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      wsRef.current.send(JSON.stringify({
        type: 'offer',
        offer: offer
      }));
    } catch (error) {
      console.error("Create offer error:", error);
    }
  };

  const handleOffer = async (offer) => {
    const pc = pcRef.current;
    if (!pc) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      wsRef.current.send(JSON.stringify({
        type: 'answer',
        answer: answer
      }));
    } catch (error) {
      console.error("Handle offer error:", error);
    }
  };

  const handleAnswer = async (answer) => {
    const pc = pcRef.current;
    if (!pc) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    } catch (error) {
      console.error("Handle answer error:", error);
    }
  };

  const handleIceCandidate = async (candidate) => {
    const pc = pcRef.current;
    if (!pc) return;

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("ICE candidate error:", error);
    }
  };

  const toggleAudio = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setLocalAudioEnabled(audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setLocalVideoEnabled(videoTrack.enabled);
      }
    }
  };

  const endCall = () => {
    cleanup();
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
              <span className="text-white text-xl">🏥</span>
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Telemedicine</h1>
              <p className="text-xs text-gray-500">Secure Video Consultation</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
              isConnected ? 'bg-green-100 text-green-700' : 
              isConnecting ? 'bg-yellow-100 text-yellow-700' : 
              'bg-gray-100 text-gray-700'
            }`}>
              <div className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-green-500 animate-pulse' : 
                isConnecting ? 'bg-yellow-500 animate-pulse' : 
                'bg-gray-400'
              }`}></div>
              {status}
            </div>
          </div>
        </div>
      </div>

      {/* Video Area */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full">
          {/* Remote Video (Partner) */}
          <div className="relative bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
            <video 
              ref={remoteVideoRef} 
              autoPlay 
              playsInline
              className="w-full h-full object-cover"
            />
            {!isConnected && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
                <div className="text-center">
                  <div className="w-24 h-24 mx-auto mb-6 bg-gray-700/50 rounded-full flex items-center justify-center backdrop-blur-sm">
                    <span className="text-5xl">👤</span>
                  </div>
                  <p className="text-white text-lg font-medium mb-2">{status}</p>
                  <p className="text-gray-400 text-sm">Waiting for another user to join...</p>
                  {isConnecting && (
                    <div className="mt-6">
                      <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-gray-600 border-t-blue-500"></div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg text-sm font-medium">
              {partnerId ? `Doctor: ${partnerId.substring(0, 8)}` : 'Waiting...'}
            </div>
          </div>

          {/* Local Video (You) */}
          <div className="relative bg-gray-900 rounded-2xl overflow-hidden shadow-2xl">
            <video 
              ref={localVideoRef} 
              autoPlay 
              muted 
              playsInline
              className="w-full h-full object-cover scale-x-[-1]"
            />
            {!localVideoEnabled && (
              <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900">
                <div className="w-24 h-24 bg-gray-700/50 rounded-full flex items-center justify-center backdrop-blur-sm">
                  <span className="text-5xl">📹</span>
                </div>
              </div>
            )}
            <div className="absolute top-4 left-4 bg-black/50 backdrop-blur-sm text-white px-3 py-1.5 rounded-lg text-sm font-medium">
              You {myId && `(${myId.substring(0, 8)})`}
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white border-t border-gray-200 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={toggleAudio}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg ${
                localAudioEnabled 
                  ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' 
                  : 'bg-red-500 hover:bg-red-600 text-white'
              }`}
              title={localAudioEnabled ? "Mute microphone" : "Unmute microphone"}
            >
              <span className="text-3xl">{localAudioEnabled ? '🎤' : '🔇'}</span>
            </button>

            <button
              onClick={toggleVideo}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg ${
                localVideoEnabled 
                  ? 'bg-gray-100 hover:bg-gray-200 text-gray-700' 
                  : 'bg-red-500 hover:bg-red-600 text-white'
              }`}
              title={localVideoEnabled ? "Turn off camera" : "Turn on camera"}
            >
              <span className="text-3xl">{localVideoEnabled ? '📹' : '📷'}</span>
            </button>

            <button
              onClick={endCall}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-all shadow-lg hover:shadow-xl"
              title="End call"
            >
              <span className="text-3xl">📞</span>
            </button>
          </div>
          
          <p className="text-center text-xs text-gray-500 mt-4">
            Powered by Metered.ca • End-to-end encrypted
          </p>
        </div>
      </div>
    </div>
  );
}