import streamlit as st
import requests

st.set_page_config(page_title="Group 61 - MBTI Personality Chatbot", layout="centered")

# Invisible anchor for "Scroll to Top"
st.markdown('<a id="top"></a>', unsafe_allow_html=True)

# App header with Tsinghua logo and title
col1, col2 = st.columns([1, 10])
with col1:
    st.image("https://upload.wikimedia.org/wikipedia/en/3/3f/Tsinghua_University_Logo.png", width=50)
with col2:
    st.markdown("<h2 style='color: violet; margin-top: 12px;'>Group 61 – MBTI Personality Chatbot</h2>", unsafe_allow_html=True)
st.markdown("---")

# "Scroll to Top" button
st.markdown("""
<div style="text-align: right;">
    <a href="#top" style="color: #8338ec; font-size: 18px; text-decoration: underline;">⬆️ Scroll to Top</a>
</div>
""", unsafe_allow_html=True)

# Initialize chat history
if "messages" not in st.session_state:
    st.session_state["messages"] = []

# Display chat messages
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

# User input
prompt = st.chat_input("Say something...")
if prompt:
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    with st.chat_message("assistant"):
        with st.spinner("Thinking..."):
            headers = {
                "Authorization": f"Bearer {st.secrets['OPENROUTER_API_KEY']}",
                "Content-Type": "application/json"
            }

            data = {
                "model": "mistralai/mixtral-8x7b-instruct",
                "messages": st.session_state.messages,
            }

            response = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers=headers,
                json=data
            )

            try:
                bot_msg = response.json()["choices"][0]["message"]["content"]
            except Exception as e:
                bot_msg = f"Error: {e}\n\n{response.text}"

            st.markdown(bot_msg)
            st.session_state.messages.append({"role": "assistant", "content": bot_msg})
